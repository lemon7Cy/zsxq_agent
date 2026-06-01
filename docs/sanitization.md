# Sanitization Checklist

Run these checks before publishing:

```bash
find . -maxdepth 3 -type f | sort
rg -n "sk-|gho_|access_token|zsxq_access_token|Cookie|Authorization|api_key|oops\\.asia" .
git status --short
```

Expected:

- no `data/` directory in git
- no `.cache/` directory in git
- no HAR files
- no generated private skills
- no real API keys or access tokens
- no frontend build output or dependency directories

