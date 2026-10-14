import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { getChatGPTUser } from "../chatgpt-auth";
import { netlifyAuthConfigured } from "../../lib/netlify-auth";

export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (env.APP_RUNTIME !== "netlify") redirect("/");
  if (await getChatGPTUser()) redirect("/");
  const configured = netlifyAuthConfigured(), { error } = await searchParams;
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f4ed", padding: 24 }}>
    <section style={{ width: "100%", maxWidth: 420, background: "white", padding: 32, borderRadius: 24, boxShadow: "0 16px 60px #173e2812", color: "#20372b" }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>🥬</div>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Собрано</h1>
      <p style={{ marginBottom: 24 }}>Ваше семейное меню и покупки.</p>
      {!configured ? <p role="alert">Вход ещё не настроен. В параметрах среды Netlify добавьте APP_PASSWORD (от 16 символов) и APP_SESSION_SECRET (от 32 символов), затем повторите деплой.</p> :
        <form action="/api/session" method="post">
          <label htmlFor="password" style={{ display: "block", marginBottom: 8 }}>Пароль</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={500} style={{ width: "100%", padding: 14, border: "1px solid #cad5cb", borderRadius: 12, marginBottom: 16 }} />
          {error && <p role="alert" style={{ color: "#a12626", marginBottom: 16 }}>Не удалось войти. Проверьте пароль и попробуйте снова.</p>}
          <button type="submit" style={{ width: "100%", borderRadius: 12, padding: 14, color: "white", background: "#315d45", fontWeight: 600 }}>Войти</button>
        </form>}
    </section>
  </main>;
}
