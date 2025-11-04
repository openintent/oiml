-- AlterTable
ALTER TABLE "todos" ADD COLUMN "project_id" UUID;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

