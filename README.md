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

Place the current employee workbook at `public/org-data.xlsx`. The app reads the
`PMO Report` sheet (or the first sheet if that name is absent) every time it
loads. Replace the file and refresh the page when employee data changes.

The header row must contain:

`Username`, `Name`, `Email`, `Designation`, `Status`, `Manager`, `Division`,
`Department`, `Department Category`, `Project Name`, `Last Working Day`, `TSM`

Reporting lines are built by matching `Manager` to `Name` without regard to
capitalisation or surrounding spaces. Status and organisation fields accept any
text; rows are not filtered by Status.

The workbook is ignored by Git because it contains employee data. If it is
missing or invalid, the app falls back to `public/org-data.json`. Each JSON node:

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
