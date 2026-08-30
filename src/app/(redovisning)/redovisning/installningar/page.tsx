import { PageHeader } from "@/components/ui";
import { LogoutRow } from "@/components/logout-button";
import { isSupabaseMode } from "@/lib/storage/config";

export const metadata = { title: "Inställningar" };

export default function AccountantSettingsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Inställningar" subtitle="Profil och utloggning. Byrå-ERP byggs inte här." />
      {isSupabaseMode() ? <LogoutRow variant="sidebar" /> : null}
    </div>
  );
}
