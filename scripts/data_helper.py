#!/usr/bin/env python3
"""Helper de análisis de datos para dsh-plugin-data-analyst.
JSON por stdin {"cmd": "profile|query|groupby|write", ...} → JSON por stdout.
"""
import json
import sys

import pandas as pd


def load(path):
    lower = path.lower()
    if lower.endswith(('.xlsx', '.xls')):
        return pd.read_excel(path)
    if lower.endswith('.json'):
        return pd.read_json(path)
    return pd.read_csv(path)


def clean(value):
    if value is None:
        return None
    if pd.isna(value):
        return None
    if hasattr(value, 'item'):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def cmd_profile(payload):
    df = load(payload['path'])
    numeric = df.select_dtypes(include='number')
    info = {
        'ok': True,
        'rows': int(df.shape[0]),
        'columns': int(df.shape[1]),
        'columnNames': [str(c) for c in df.columns],
        'dtypes': {str(c): str(df[c].dtype) for c in df.columns},
        'nulls': {str(c): int(df[c].isna().sum()) for c in df.columns if int(df[c].isna().sum()) > 0},
        'describe': json.loads(numeric.describe().to_json()) if not numeric.empty else {},
        'head': json.loads(df.head(int(payload.get('head', 5))).to_json(orient='records')),
        'topValues': {str(c): [clean(v) for v in df[c].value_counts().head(5).index] for c in df.columns if df[c].dtype == object and df[c].nunique() <= 30},
    }
    return info


def cmd_query(payload):
    df = load(payload['path'])
    expression = payload.get('expression')
    if expression:
        df = df.query(expression)
    columns = payload.get('columns')
    if columns:
        missing = [c for c in columns if c not in df.columns]
        if missing:
            raise RuntimeError(f'columnas inexistentes: {", ".join(missing)}')
        df = df[columns]
    limit = int(payload.get('limit', 50))
    total = int(df.shape[0])
    head = df.head(limit)
    return {'ok': True, 'matched': total, 'returned': int(head.shape[0]), 'rows': json.loads(head.to_json(orient='records'))}


def cmd_groupby(payload):
    df = load(payload['path'])
    by = payload.get('by')
    if not by or by not in df.columns:
        raise RuntimeError(f'columna de agrupación inválida: {by}')
    metric = payload.get('metric')
    agg = payload.get('agg', 'count')
    if metric and metric not in df.columns:
        raise RuntimeError(f'métrica inválida: {metric}')
    if agg == 'count':
        result = df.groupby(by).size().sort_values(ascending=False)
    else:
        numeric = df[metric] if metric else df.select_dtypes(include='number').iloc[:, 0]
        if agg == 'sum':
            result = df.groupby(by)[numeric.name].sum().sort_values(ascending=False)
        elif agg == 'mean':
            result = df.groupby(by)[numeric.name].mean().sort_values(ascending=False)
        elif agg == 'min':
            result = df.groupby(by)[numeric.name].min().sort_values(ascending=False)
        elif agg == 'max':
            result = df.groupby(by)[numeric.name].max().sort_values(ascending=False)
        else:
            raise RuntimeError(f'agregación inválida: {agg}')
    limit = int(payload.get('limit', 30))
    rows = [{by: clean(index), 'value': clean(value)} for index, value in result.head(limit).items()]
    return {'ok': True, 'rows': rows, 'groups': int(result.shape[0])}


def cmd_write(payload):
    df = load(payload['path'])
    if payload.get('expression'):
        df = df.query(payload['expression'])
    if payload.get('columns'):
        df = df[payload['columns']]
    output = payload['output']
    if output.lower().endswith('.xlsx'):
        df.to_excel(output, index=False)
    else:
        df.to_csv(output, index=False, encoding='utf-8-sig')
    return {'ok': True, 'written': output, 'rows': int(df.shape[0]), 'columns': int(df.shape[1])}


def main():
    try:
        payload = json.loads(sys.stdin.read() or '{}')
        cmd = payload.get('cmd')
        handlers = {'profile': cmd_profile, 'query': cmd_query, 'groupby': cmd_groupby, 'write': cmd_write}
        if cmd not in handlers:
            raise RuntimeError(f'comando desconocido: {cmd}')
        sys.stdout.write(json.dumps(handlers[cmd](payload), ensure_ascii=False))
    except Exception as error:
        sys.stdout.write(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        sys.exit(0)


if __name__ == '__main__':
    main()
