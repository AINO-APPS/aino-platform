# Search module

Owns the tenant-scoped `GET /api/search` workflow.

## Layers

```text
routes/search.ts -> search.service.ts -> search.repository.ts
```

- The compatibility route owns authentication, tenant resolution and HTTP errors.
- The service owns input normalization, role-aware audit visibility, note matching and caching.
- The repository owns SQL for tasks, notebooks, users, calendar events, leave, sprints and audit logs.

The public method, path, middleware ordering, grouped response, limits and Redis cache behavior remain unchanged.