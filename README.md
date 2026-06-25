# Report de Eficiencia de Preparaciones

Análisis de **eficiencia en tiempos de preparación** (setup) en planta.

**Basado en**: Tabla SAP `NOTIFICACIONES_OFS` en BD `OLAPS_MZ`.

## Requisitos

- **Node.js ≥ 18 LTS**
- **SQL Server** con acceso a BD `OLAPS_MZ` y tabla `NOTIFICACIONES_OFS`
- **Conectividad TCP** a `SRVBI:1433`

## Instalación y arranque

```bash
npm install
cp .env.example .env  # Rellenar SQL_USER / SQL_PASSWORD
npm start
# → http://localhost:3002
```

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/test` | Health check |
| GET | `/api/preparaciones` | Datos filtrados + KPIs |
| GET | `/api/preparaciones/filtros` | Valores para combos |

## Parámetros filtros

```
?centro=1120              — centro (coma-separado)
?desde=20260101           — fecha inicio
?hasta=20260331           — fecha fin
?limit=20000              — máximo filas
```

## KPIs

Calcula automáticamente:
- `eficiencia_pct`: ratio STD vs REAL
- `desviacion_total`: minutos por encima/debajo STD
- `bajo_std` / `sobre_std`: conteo de preparaciones

## Variables de entorno

```
PORT=3002
SQL_SERVER=SRVBI
SQL_DATABASE=OLAPS_MZ
SQL_USER=<usuario>
SQL_PASSWORD=<password>
```

## Desarrollo

```bash
npm run dev
```

---

Modularizado desde reports-hub.
