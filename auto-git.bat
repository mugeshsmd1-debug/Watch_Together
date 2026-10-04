@echo off
title OurScreen - Auto Git Sync
cls
echo ========================================================
echo   OurScreen - Auto Git & Vercel Synchronizer
echo ========================================================
echo.
echo Starting file watcher... Any saved file will be committed
echo and pushed to GitHub automatically to trigger Vercel deploy.
echo.
node scripts\auto-git.js
pause
