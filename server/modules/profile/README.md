# Profile module

`profileQuery` owns the read that hydrates a caller's session. It resolves the
profile row against tenant DBs of different vintages, dropping the optional
`notification_prefs` column when necessary. Sprint configuration is no longer
stored on teams. The route must never 500 a session hydration because a tenant
database predates a migration.
