// Telegram notifications for the HR team.
//
// POST { action: "nowe", id }            PUBLIC — called by the intake form right after a
//   submission is saved. Nothing in the request is trusted: the row is read with the
//   service role and a message goes out only if it is a fresh 'nowe' submission that
//   has not been announced yet (the "announced" mark is a conditional update made before
//   sending: one id = at most one message). The message carries no personal data of the
//   worker; the employer's name typed into the public form is cleaned first (logic.ts).
// POST { action: "status" }              admin — bot name, whether it can list chats, saved chats
// POST { action: "chats" }               admin — chats that wrote to the bot recently
// POST { action: "save", chats: [...] }  admin — store the chats to notify
// POST { action: "test" }                admin — send a test message to the saved chats

import { handle } from "./core.ts";

Deno.serve(handle);
