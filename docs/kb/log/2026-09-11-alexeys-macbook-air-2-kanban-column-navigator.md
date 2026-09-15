# Kanban column navigator

Date: 2026-09-11

Added a synchronized column select and previous/next controls to the board filter
bar. Navigation scrolls and focuses the selected column, reports it through the
existing live region, observes hidden-column visibility, and works in both board
layouts. The affected gate and Chromium checks covered wide, hidden-column,
swimlane, and mobile cases.
