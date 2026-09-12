import http from "k6/http";
import { check, sleep } from "k6";
import { APP_URL, pickOrg } from "./lib/config.js";
import { loginAndSetCookie } from "./lib/auth.js";

export const options = { vus: 1, iterations: 1 };

export default function () {
  const org = pickOrg(0);
  const jar = http.cookieJar();
  const ok = loginAndSetCookie(jar, org.ownerEmail, org.ownerPassword);
  check(ok, { "login succeeded": (v) => v === true });

  const res = http.get(`${APP_URL}/dashboard`);
  check(res, {
    "dashboard 200": (r) => r.status === 200,
    "not redirected to login": (r) => !r.url.includes("/login"),
  });
  console.log(`dashboard status=${res.status} title-has-overview=${res.body.includes("Overview")}`);
  sleep(1);
}
