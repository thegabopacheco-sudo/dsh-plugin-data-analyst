# dsh-plugin-data-analyst — Data Analyst

Analista de datos para DeepSeek Harness: perfil de CSV/XLSX/JSON, consultas con pandas, agrupaciones y exportacion a CSV/XLSX, usando el Python bundled de DSH.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `profile` | Perfil del dataset |
| `query` | Consultar filas |
| `groupby` | Agrupar |
| `export` | Exportar subconjunto |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-data-analyst` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-data-analyst
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_DATA_ANALYST_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\data-analyst\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
