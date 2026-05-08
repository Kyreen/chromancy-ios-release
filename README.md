<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3dc23b0b-6dd3-4fca-b38f-d865e55d6724

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create a local environment file from `.env.example` and set your server-side variables there.
3. Configure Vertex AI backend variables (`CHROMANCY_AI_PROVIDER=vertex`, `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION`) plus webhook secrets on the backend only. Do not expose AI credentials as `VITE_*` variables.
4. Run the app:
   `npm run dev`
