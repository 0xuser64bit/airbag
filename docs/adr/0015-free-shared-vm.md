# 0015. Host on one free, shared VM

Date: 1 Oct 2026. Supersedes [0004](0004-hosting.md) (Fly.io for the engine, Vercel for the web).

## Context

There is no budget for hosting. The owner already runs an Oracle Cloud free-tier VM (Ampere ARM,
2 cores, 11 GB, Ubuntu 20.04) that serves several other projects behind one Caddy, with its own
system Node 20 and processes on common ports, 3000 and 8787 among them. 0004 picked Fly.io mainly
for an app-scoped static egress IP; an OCI instance's public IP is fixed for the instance's life,
which serves the same purpose.

## Decision

- **Engine and web both run on that VM**, as an unprivileged `airbag` user under two sandboxed
  systemd units bound to localhost (engine 8789, web 3089). Caddy terminates TLS for Airbag's own
  hostname, `airbag.user64bit.world`, in a marked block of the shared Caddyfile that is validated
  and backed up before every reload. The engine's API is served under `/engine` on that same
  origin: one DNS record (the rest of `*.user64bit.world` points elsewhere) and no CORS preflights.
- **Airbag brings its own Node 24** in `/opt/airbag/node`; the system Node belongs to the other
  projects.
- **`deploy/vm/deploy.sh` ships the committed HEAD** with `git archive`. On the VM each commit is
  built in its own release directory and the `app` symlink only moves once install and build
  succeed, so a failed build never takes the running demo down, and rolling back is moving the
  symlink. The three newest releases are kept.
- Configuration lives in `/etc/airbag/engine.env` (root:airbag, 0640), written once; a deploy
  only keeps its `WEB_ORIGIN` in step with the hostname. The public URLs are baked into each web
  build.
- What runs there today is the public **simulation** demo. A live engine can use the VM's IP as
  the egress address on users' key allow-lists.

## Consequences

- Hosting costs nothing, and the demo is one command away from any commit.
- The host is shared. For the simulation, which holds no real keys, that is fine. A live engine
  would put sealed Perpl keys and their master key on a machine other projects administer as
  root, so before real funds it belongs on its own host or at least its own VM.
- One machine, no failover, no automatic backups: take SQLite backups with the engine's `backup`
  command and copy them off the VM (docs/DEPLOY.md).
- `apps/engine/Dockerfile` stays as a tested build of the engine for any host that prefers
  containers; nothing deploys it today.
