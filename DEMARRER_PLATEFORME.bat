@echo off
title Aureus RWA - Plateforme
echo ==============================================
echo   AUREUS RWA - Demarrage de la plateforme
echo ==============================================
echo.
cd /d "%~dp0"
echo Le site va s'ouvrir dans votre navigateur...
echo Pour arreter le serveur, fermez cette fenetre.
echo.
start "" http://localhost:3000
node server.js
pause
