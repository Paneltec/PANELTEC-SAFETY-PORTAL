# .132jn — Fleet Tag Filter + 2-Line Asset Names + Folder Icons by Name

## Task 1: Fleet Tag Dropdown

### Data source
- **Endpoint**: `GET /api/fleet/navixy/tags` (existing from `.132ir`)
- **Matching**: Navixy tags `vehicle_id` (UUID) matches fleet register `id` (UUID) — 100% overlap (50/50 assets matched)
- **Enrichment**: Each fleet asset is enriched with its `tag_label` from the Navixy tags response
- **Tag list**: Derived from enriched assets, sorted alphabetically with counts

### Tags discovered
| Tag | Count |
|---|---|
| Company Vehicle | 3 |
| Plant-Machinery | 4 |
| Plumber Vehicle | 3 |
| Service Vehicle | 12 |
| Tipper | 2 |
| Tippers Under 10 Yarder | 5 |
| Traffic Dept | 17 |
| Vac Truck Dumping | 4 |

### UI
- Tag filter button above search: "All tags (50)" default, shows dropdown modal on tap
- Modal with scrollable tag list, each entry shows label + count + checkmark for active
- Selected tag highlighted in orange, persisted in AsyncStorage (`paneltec_fleet_selected_tag`)
- Clear button (✕) on filter when a tag is active
- Combines with search — both filters active simultaneously

## Task 2: 2-Line Asset Names

- Asset name `<Text>` changed to `numberOfLines={2} ellipsizeMode="tail"` with `fontSize: 14` (was implicit 16)
- Added `lineHeight: 19` for comfortable 2-line reading
- Sub-text now shows: rego · tag name · site (combined with `·` separator)
- Tile `minHeight: 72` ensures consistent layout for single vs multi-line names

## Task 3: Docs Folder Icons

### Module: `mobile/src/lib/folderIcons.ts`
18 regex rules, first match wins. Case-insensitive.

### Actual folder icon assignments
| Folder Name | Icon | Tint |
|---|---|---|
| SDS (Safety Data Sheets) | flask | #EF4444 (red) |
| Uncategorised | file-tray-full | #94A3B8 (grey) |
| Administration | settings | #64748B (slate) |
| Compliance & Safety | shield-checkmark | #10B981 (green) |
| Work | briefcase | #F59E0B (amber) |
| Training & Competency | school | #3B82F6 (blue) |
| IMS (Integrated Management System) | grid | #8B5CF6 (purple) |
| Archives | archive | #94A3B8 (grey) |
| Equipment & Assets | construct | #EF4444 (red) |

All folder names matched correctly — no false positives or mismatches.

### Icon circle background
Uses `fi.tint + '18'` (hex with 10% opacity) for a subtle tinted circle that matches the icon colour.

## Files Touched
- **New**: `mobile/src/lib/folderIcons.ts`
- **Modified**: `mobile/app/(tabs)/fleet.tsx` (full rewrite — tag filter, 2-line names, tag enrichment)
- **Modified**: `mobile/app/(tabs)/docs.tsx` (folder icon import + rendering)
- **Modified**: `mobile/src/lib/version.ts`, `mobile/app.json` (version bump)

## EAS Build
- **Build ID**: `a003c8c9-a495-4120-bb82-646424310e32`
- **Profile**: `preview-apk`
- **Commit**: `fd84c41b`
- **Version**: 1.0.28 / build 150
