#!/bin/bash

echo "=============================="
echo "   UPLOAD PROJECT TO GITHUB   "
echo "=============================="

# ===== INPUT =====
read -p "👉 Repo URL (https://github.com/user/repo.git): " REPO
read -p "👉 Commit message: " MSG

# ===== NHẬP TOKEN (ẨN) =====
echo ""
read -s -p "🔐 Nhập GitHub Token: " GITHUB_TOKEN
echo ""

# ===== CLEAN FILE NHẠY CẢM =====
echo "🧹 Cleaning secret files..."

touch .gitignore

grep -qxF ".env" .gitignore || echo ".env" >> .gitignore
grep -qxF "config.json" .gitignore || echo "config.json" >> .gitignore
grep -qxF "node_modules/" .gitignore || echo "node_modules/" >> .gitignore

git rm --cached config.json 2>/dev/null
git rm --cached .env 2>/dev/null

# ===== RESET GIT =====
echo "🔥 Reset git history..."
rm -rf .git

git init
git add .
git commit -m "$MSG"

# ===== CHUYỂN LINK REPO SANG TOKEN AUTH =====
# https://github.com/user/repo.git
# -> https://TOKEN@github.com/user/repo.git

AUTH_REPO=$(echo $REPO | sed "s#https://#https://$GITHUB_TOKEN@#")

# ===== ADD REMOTE =====
git remote add origin $AUTH_REPO

# ===== PUSH =====
echo "🚀 Pushing to GitHub..."

git branch -M main
git push -f origin main

echo "=============================="
echo "✅ DONE! Upload thành công"
echo "=============================="