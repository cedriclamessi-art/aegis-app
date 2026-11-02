# Run /clone-website locally

```bash
git clone https://github.com/Mood-Global-Services/How-to-Clone-Website---Claude-Skills.git
cd How-to-Clone-Website---Claude-Skills
unzip ai-website-cloner-template-master.zip
cp -r ai-website-cloner-template-master my-clone && cd my-clone
cp /path/to/aegis-app/replica/clone-setup/TARGET.md ./TARGET.md
npm install
claude --chrome
```

Then in Claude Code:

```
/clone-website https://shopamua.com
```

Needs Node 20+, Claude Code and Chrome. The skill is in `.claude/skills/clone-website/` of the template.
