import { requireRole } from "@/lib/auth";
import AuthBar from "@/components/AuthBar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("admin");
  return (
    <div>
      <AuthBar username={session.username} roleLabel="администратор" />
      {children}
    </div>
  );
}
