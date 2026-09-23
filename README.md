# Organisation chart

Two views of the same `org-data.json` file:

- **Chart** — classic top-down boxes and reporting lines. Expand or collapse a branch. Click a name to select it.
- **Directory** — drill-down cards for one leader and their direct reports.

## Run

```bash
npm install
npm run dev
```

## Data

Replace `public/org-data.json`. The app fetches it at runtime. Each node:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required |
| `designation` | string | Required |
| `section` | `"IT"` \| `"BPO"` \| `null` | Set on department or team nodes |
| `count` | number \| `null` | Shown when `section` is set |
| `children` | array | Same shape; use `[]` for individual contributors |

## Behaviour

- Breadcrumbs jump to any ancestor.
- Search jumps to a person or team by name or title.
- **Rolled-up headcount** shows branch totals. If a node’s `count` already covers its descendants (a department total), that figure is kept and not added again.
