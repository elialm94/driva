import { ExternalLink, Globe, Inbox, WandSparkles } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/store";
import { datumTid } from "@/lib/format";
import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { SiteRenderer } from "@/components/site-renderer";
import { GenerateWebsiteForm, PublishWebsiteButton, SectionEditor } from "@/components/site-widgets";
import { CopyLinkButton } from "@/components/copy-button";

export const metadata = { title: "Hemsida" };

const SECTION_LABELS: Record<string, string> = {
  hero: "Startsektion",
  tjanster: "Tjänster",
  om: "Om oss",
  galleri: "Galleri",
  kontakt: "Kontakt & offertförfrågan",
};

export default function WebsitePage() {
  const data = db();
  const site = data.website;

  if (!site) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Hemsida" subtitle="Beskriv ditt företag så bygger AI:n en färdig hemsida på några sekunder." />
        <Card className="px-6 py-8 sm:px-10 sm:py-12">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-accent-soft">
              <WandSparkles className="size-6.5 text-accent" />
            </div>
            <h2 className="mt-5 text-[22px] font-semibold tracking-tight">Vad gör ditt företag?</h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-soft">
              AI:n skapar startsida, tjänster, om oss, galleri och ett kontaktformulär som skickar förfrågningar rakt
              in i Driva. Du kan ändra allt efteråt.
            </p>
          </div>
          <div className="mx-auto mt-8 max-w-2xl">
            <GenerateWebsiteForm />
          </div>
        </Card>
      </div>
    );
  }

  const published = site.status === "publicerad";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Hemsida"
        subtitle={
          published
            ? `Publicerad ${site.publishedAt ? datumTid(site.publishedAt) : ""} · formuläret skapar förfrågningar automatiskt`
            : "Utkast – granska och publicera när du är nöjd"
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href={published ? "/sajt" : "/sajt?preview=1"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 text-[13px] font-medium text-soft transition-colors hover:text-ink"
            >
              <ExternalLink className="size-3.5" /> Öppna i ny flik
            </a>
            <PublishWebsiteButton published={published} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Live-preview */}
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Globe className="size-4" />
              <span className="font-mono text-[12px]">
                {published ? "driva.site/" + site.slug : "Förhandsvisning"}
              </span>
              <Badge tone={published ? "ok" : "warn"}>{published ? "Publicerad" : "Utkast"}</Badge>
            </div>
            <CopyLinkButton path="/sajt" label="Kopiera länk" />
          </div>
          <div className="overflow-hidden rounded-3xl border border-line shadow-card">
            <div className="flex items-center gap-1.5 border-b border-line bg-canvas px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              <SiteRenderer website={site} company={data.settings} interactive={false} />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Det här är exakt vad besökarna ser. Formuläret är aktivt på den publicerade sajten.
          </p>
        </div>

        {/* Sidopanel */}
        <div className="space-y-6">
          <div>
            <SectionTitle>Innehåll</SectionTitle>
            <Card className="divide-y divide-line/70">
              {site.sections.map((s) => (
                <SectionEditor
                  key={s.id}
                  sectionId={s.id}
                  typeLabel={SECTION_LABELS[s.type] ?? s.type}
                  heading={s.heading}
                  body={s.body}
                />
              ))}
            </Card>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Klicka på en sektion för att ändra text själv eller låta AI:n skriva om den.
            </p>
          </div>

          <div>
            <SectionTitle>Förfrågningar från sajten</SectionTitle>
            <Card className="px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-info-soft">
                  <Inbox className="size-4.5 text-info" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold tabular">{site.submissions}</p>
                  <p className="text-[12px] text-muted">förfrågningar via formuläret</p>
                </div>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-soft">
                När någon skickar formuläret skapas kunden och förfrågan automatiskt och dyker upp på{" "}
                <Link href="/" className="font-medium text-accent hover:underline">
                  Hem
                </Link>
                .
              </p>
            </Card>
          </div>

          <div>
            <SectionTitle>Domän</SectionTitle>
            <Card className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-soft">
                I produktion kopplar du din egen domän (t.ex.{" "}
                <span className="font-medium text-ink">{site.slug}.se</span>) med automatiskt SSL. I demon ligger sajten
                på <span className="font-mono text-[12px]">/sajt</span>.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
