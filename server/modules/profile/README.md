# Profile module

`profileQuery` owns the read that hydrates a caller's session. It resolves the
profile row against tenant DBs of different vintages, dropping one optional
column per attempt (`notification_prefs`, then `teams.sprint_start_date`), and
reports whether the sprint-config column was available. The route must never
500 a session hydration because a tenant database predates a migration.
