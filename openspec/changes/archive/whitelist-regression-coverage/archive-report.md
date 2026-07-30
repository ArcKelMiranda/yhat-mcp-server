# Archive: whitelist-regression-coverage

## Verdict

PASS

## Summary

This is a test-only regression lock for `validator.ts` and `whitelist.ts`. 22 new tests cover deep table reference capture (UNION, UNION ALL, subqueries, CTEs, JOINs), authorization outcomes, identifier normalization, schema collision, and mode field behavior. No production code or dependency changes. The verifier confirmed empirically that the tests would catch regressions, including the original UNION bypass concern and the CTE alias leak. The archived `tasks.md` was mechanically reconciled from `apply-progress.md` and `verify-report.md` so the archive trail contains no stale unchecked tasks.

## Artifacts archived

- proposal.md
- specs/query-guard/spec.md
- design.md
- tasks.md
- apply-progress.md
- verify-report.md

## Spec sync

Capability `query-guard` (under `openspec/specs/`) created from delta spec. Capability covers:
- Validator classification (deep references)
- Whitelist authorization
- Identifier normalization
- Mode field behavior (locked as ignored)

## Commits shipped

- `b4d1aca` test(guard): add validator unit tests for deep reference capture
- `7663ee9` test(guard): add whitelist unit tests for authorization outcomes

## Test delta

- Before: 71 tests.
- After: 93 tests (+22 in tests/validator.test.ts and tests/whitelist.test.ts).
- Coverage: 100% of spec scenarios have a covering test.

## Residual follow-ups (non-blocking)

- CTE-alias-in-tableList behavior is locked. If a future change wants to fix it (so that CTE aliases are not required in the whitelist), that change will need to update these tests.
- `mode: read_only` is currently ignored by `authorizeQueryTables`. These tests lock that behavior. Implementing `mode` semantics (if ever desired) would also require updating these tests.
- `node-sql-parser` version `^5.3.13` is a runtime dependency. Future upgrades could change AST shape; these tests will detect the regression.

## Recommendation

The change is archived. Capability `query-guard` now exists as a tested coverage area. Future security-sensitive changes to the query guard (UNION handling, subqueries, CTEs) can extend this capability without reopening the archive.
