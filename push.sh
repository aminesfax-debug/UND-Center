#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
echo "📦 UND Center — Déploiement en cours..."
git add -A
git commit -m "Update $(date '+%Y-%m-%d %H:%M')"
git push && echo "✅ Déployé ! https://aminesfax-debug.github.io/UND-Center/" || echo "❌ Erreur push"
