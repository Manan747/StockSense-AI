@echo off
cd /d "%~dp0"
echo Starting StockSense AI Backend...
.venv\Scripts\python run.py
pause
