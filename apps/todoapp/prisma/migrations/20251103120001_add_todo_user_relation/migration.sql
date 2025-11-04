-- AlterTable
-- Add user_id column to todos table
-- Note: If there are existing todos without a user, you'll need to either:
-- 1. Delete them first, or
-- 2. Create a default user and assign existing todos to it, or
-- 3. Temporarily make this nullable, populate it, then make it NOT NULL
ALTER TABLE "todos" ADD COLUMN "user_id" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

