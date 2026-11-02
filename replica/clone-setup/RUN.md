# Run /clone-website locally

The template is ready in `replica/clone-setup/my-clone/` with `TARGET.md` already filled in.

```bash
git clone https://github.com/cedriclamessi-art/aegis-app.git
cd aegis-app
git checkout claude/pensive-clarke-ih0u7g
cp -r replica/clone-setup/my-clone ~/my-clone
cd ~/my-clone
npm install
claude --chrome
```

Then in Claude Code:

```
/clone-website https://shopamua.com
```

Needs Node 20+, Claude Code and Chrome. The skill is in `.claude/skills/clone-website/`.
