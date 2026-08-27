import { db } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { AssistantChat } from "@/components/assistant-chat";

export const metadata = { title: "Assistent" };

export default function AssistantPage() {
  const messages = db().assistantMessages;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Assistent"
        subtitle="Din AI-administratör – ber om lov innan något skickas till kunder."
      />
      <AssistantChat messages={messages} />
    </div>
  );
}
