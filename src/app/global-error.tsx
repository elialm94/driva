"use client";

/**
 * Ersätter Next.js inbyggda engelska "This page couldn't load".
 * Root-layoutfel och avhuggna RSC-navigeringar (React #412) landar här.
 * Full omladdning — inte retry() — eftersom klientcachen kan vara trasig.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="sv">
      <head>
        <title>Sidan kunde inte laddas · Driva</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f4",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          color: "#1c1917",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 24 * 16,
            margin: "0 16px",
            padding: 24,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e7e5e4",
            borderRadius: 16,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Sidan kunde inte laddas
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "#78716c" }}>
            Något gick fel när sidan hämtades. Ladda om, eller gå tillbaka till startsidan.
          </p>
          {error.digest ? (
            <p style={{ margin: "8px 0 0", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#a8a29e" }}>
              {error.digest}
            </p>
          ) : null}
          <form style={{ marginTop: 20 }}>
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "10px 16px",
                border: 0,
                borderRadius: 8,
                background: "#1c1917",
                color: "#fff",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Ladda om
            </button>
          </form>
          <a
            href="/"
            style={{
              display: "block",
              marginTop: 8,
              padding: "10px 16px",
              border: "1px solid #d6d3d1",
              borderRadius: 8,
              color: "#44403c",
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Till startsidan
          </a>
        </main>
      </body>
    </html>
  );
}
