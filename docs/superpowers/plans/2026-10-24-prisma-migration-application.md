# Prisma migration application

> Execute inline with the Superpowers executing-plans and verification workflows.

Goal: apply the pending Sessions/Profile SQL with Prisma Migrate locally and on the owner-authorized production database, preserving SQL functions and existing records.

Authorization: direct chat request on 2026-10-24 to apply for local and production. No participant-data export or application deployment is included.

- [x] Render deterministic transactional Prisma migration directories from the existing SQL authority: known installed baseline, five-file Sessions/Profile transition, and subsequent source files. Keep local and hosted namespace mapping explicit and Prisma history in an isolated RallyPoint schema.
- [x] Validate target selection and existing state before baselining; adopt already-applied local SQL without replaying it or disturbing newer local work. Exercise Prisma deployment, repeat/no-op and rollback on disposable synthetic databases. Use Prisma for subsequent local startup migrations.
- [x] Apply locally, then production. Compare record hashes excluding only intended stored names, function signatures, RLS/grants and unrelated metadata; check public APIs and authenticated local reads. Update PR #35 with actual evidence and remaining live-auth limitations.

Recovery: explicitly wrap migration SQL in one transaction; keep the baseline and source definitions for forward repair. Preserve the owner's decision to use migrations without exporting real names/IDs. Existing application rollback preserves database history.
