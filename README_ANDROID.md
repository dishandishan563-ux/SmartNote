# SmartNote Android Build Instructions

This project is set up to automatically build an Android APK using GitHub Actions.

## How to get your APK:

1.  **Push your code to GitHub**: Make sure all your latest changes are pushed to the `main` branch.
2.  **Set up GitHub Secrets**:
    -   Go to your GitHub repository.
    -   Go to **Settings** > **Secrets and variables** > **Actions**.
    -   Add a new secret named `GEMINI_API_KEY` with your Gemini API key value.
3.  **Wait for the Build**:
    -   Go to the **Actions** tab in your GitHub repository.
    -   You will see a workflow named **Build Android APK** running.
    -   Wait for it to finish (it usually takes 3-5 minutes).
4.  **Download the APK**:
    -   Click on the finished workflow run.
    -   Scroll down to the **Artifacts** section.
    -   Click on **SmartNote-APK** to download the zip file containing your APK.
    -   Extract the zip and install `app-debug.apk` on your phone.

## Local Development (Optional):

If you want to build the APK on your own computer:

1.  Install [Android Studio](https://developer.android.com/studio).
2.  Run `npm install`.
3.  Run `npm run build`.
4.  Run `npx cap add android` (only the first time).
5.  Run `npx cap sync`.
6.  Run `npx cap open android` to open the project in Android Studio and build the APK from there.
