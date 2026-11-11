# Cómo funciona dsh-plugin-data-analyst

Analista de datos para DeepSeek Harness: perfil de CSV/XLSX/JSON, consultas con pandas, agrupaciones y exportacion a CSV/XLSX, usando el Python bundled de DSH.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `profile`: Perfil del dataset
- `query`: Consultar filas
- `groupby`: Agrupar
- `export`: Exportar subconjunto

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\data-analyst\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
