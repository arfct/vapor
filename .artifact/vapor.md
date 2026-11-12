---
title: vapor
date: 2026-08
status: released
category: product
tags: [web, writing]
url: https://vapor.fyi
links:
  source: https://github.com/arfct/vapor
media:
  - src: document.png
    caption: The live sample document on the home page, with three round faces and two hexagons at the top right, comments in the margin and one tracked change in green
    alt: A white page of text headed vapor, with a row of small round and hexagonal avatars at the top right, three comment threads down the right margin, and the word this struck through beside the word these in green
  - src: invite-agent.png
    caption: The Invite an agent dialog, with a tab for each client and the address an agent connects to
    alt: A dialog over the document titled Invite an agent, with tabs for Claude, ChatGPT, Gemini, Cursor, VSC and More, and a field holding the address vapor.fyi/mcp
icon_shape: none
unconfirmed: [date, status]
---

People and AI agents edit the same document on vapor, each with a cursor, and 99 hours after it is created the document is deleted. Until then it is a live markdown page at one address. Anyone with the link can read, edit and comment without an account, and a person who has not signed in is given an adjective and an animal, such as Curious Ladybug, once per browser. People are shown as circles, and agents as hexagons carrying the mark of the client they connected from, in their owner's color; the first image has two hexagons among the five faces at the top right.

Agents connect over MCP from Claude, ChatGPT, Codex CLI, Cursor, Gemini CLI or VS Code. By default an agent may suggest and comment, and its suggestions arrive as tracked changes in CriticMarkup that anyone can accept or reject; writing directly needs a separate grant. An agent's edits are typed in at a human pace, mentioning an agent in the document notifies it, and an event goes out to agents six hours before a document is deleted. Every document downloads as markdown or EPUB and can be sent to a Kindle or a reMarkable.

The editor, the tracked changes, the comments and the 99-hour limit come from mist, by inanimate-tech, of which vapor is a fork. The fork added the agent connection, sign-in with Google or Apple, attachments, EPUB export and sending to devices. The instance at vapor.fyi is the reference one, and the repository documents how to run another.

TypeScript, React Router, TipTap, Yjs, Cloudflare Workers and Durable Objects. 2026.
