import { defineConfig } from "prisma/config";

// SQL migrations under supabase/migrations remain authoritative. Generation and
// validation need no database credentials and never contact a database.
export default defineConfig({ schema: "prisma/schema.prisma" });
