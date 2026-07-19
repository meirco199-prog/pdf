# עורך PDF — גרסת דסקטופ (Windows)

אפליקציית Electron שעוטפת את עורך ה-PDF ומאפשרת התקנה כתוכנה, כולל פתיחת
קובצי PDF ישירות בתוכנה.

## איך נבנה קובץ ההתקנה

קובץ ההתקנה (‎.exe) נבנה אוטומטית ע"י GitHub Actions על שרת Windows:

- **בנייה + פרסום Release:** דחיפת תג בפורמט `vX.Y.Z` (למשל `v1.0.0`) מריצה את
  ה-workflow, בונה את ההתקנה ומפרסמת אותה כ-Release להורדה.
- **בנייה ידנית:** אפשר להריץ ידנית מלשונית *Actions* → *Build Windows Installer*
  → *Run workflow*. קובץ ההתקנה יופיע כ-Artifact של הריצה.

## בנייה מקומית (למפתחים, על Windows)

```bash
# מהשורש של המאגר, העתיקו את קבצי האתר אל desktop/app
mkdir desktop\app
copy index.html desktop\app\
copy *.png desktop\app\
copy manifest.webmanifest desktop\app\

cd desktop
npm install
npm start        # הרצה לבדיקה
npm run dist     # בניית קובץ ההתקנה אל desktop/dist
```

## פתיחת PDF בתוכנה

לאחר ההתקנה: קליק ימני על קובץ PDF → *פתח באמצעות* → *עורך PDF*
(אפשר לסמן "פתח תמיד באמצעות" כדי שזו תהיה ברירת המחדל).
