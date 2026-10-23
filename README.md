# SBB Cargo Int — Angular BI

An Angular 22 + ECharts 6 app over the SBB Cargo Int Power BI semantic models, with a FastAPI backend. It
rebuilds the existing reports as one interactive app, linked across showcases and with a scripted story mode.
This repository holds the **live version on real data**. Code only: no data, no build output, no synthetic
package.

## Layout

| Path | What |
|---|---|
| `demo/app/` | Angular app: start page, showcases AC-1, AC-2, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10, AC-13, platform metrics, shared story mode |
| `demo/backend/` | FastAPI backend: named, whitelisted DAX queries per showcase (`queries/<showcase>/<name>.dax` + `.roles.json`), guard, in-memory cache, rate limiter, HMAC masking of person labels, role-coverage and forbidden-column checks; offline tests in `tests/` |
| `demo/run.ps1` | integrated app: backend on 127.0.0.1:8765 + `ng serve` on 4200, **real data by default**, `-Masked` for pseudonyms |
| `demo/dev.ps1` | dev pair for one showcase (own ports, own rate limit), always masked |
| `demo/py.ps1` | runs a script against the backend code (always masked) |
| `demo/OWNERSHIP.md` | who owns which files, core API, DAX traps for showcase authors |
| `env.ps1` | tool locations (Node, uv, Python under `D:\opt`); every script dot-sources it |

## Running it

```powershell
D:\work\sbbcargoint\tmp\metrics_app_spike\demo\run.ps1
```

It needs `az login` with an identity that has Read + Build on the semantic models. The backend fetches the
Power BI token itself; the browser never sees it. `executeQueries` allows 120 calls per minute per user, so the
integrated backend limits itself to 110. Real names and figures show by default: local screen only, never
share or screenshot. `run.ps1 -Masked` shows every person as a pseudonym `P-xxxxxx`; automated agents always
start it that way.

## Data protection

- Nothing in this repository holds customer data. Query results live in the backend's memory only (no disk
  cache).
- The forbidden-column guard keeps absence reasons and birth dates out of every query.
- Before the first push, every file was checked against the live label sets, the headline totals and the
  estate's GUIDs and endpoints, in process, with counts only.

## Not in this repository

Kept out on purpose:

- the working plan, handovers, per-query documentation with measured figures, and parity and probe scripts;
- the synthetic offline build. It lives in the separate repository `sbbcargoint-bi-angular-spike`, which is
  for showcasing on other devices.

Some scripts still name the original working folder `D:\work\sbbcargoint\tmp\metrics_app_spike\`.
