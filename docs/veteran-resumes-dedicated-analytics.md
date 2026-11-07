# Dedicated VeteranResumes.com Analytics property

Configuration: the separate VeteranResumes.com property uses `G-H7B54FKZGX`,
supplied by the owner on November 7, 2026. The main website's legacy app keeps
`G-CMFKLT321J`. Deployment of this change activates the new routing.

## Google account settings

1. Open https://analytics.google.com/analytics/web/ with the account that owns the
   site's Analytics and select the dedicated `VeteranResumes.com` property.
2. Its Web data stream for `https://veteranresumes.com/` uses `G-H7B54FKZGX`.
   Keep enhanced measurement off: the app's
   consent-based collector already supplies permitted page views and events and
   must not collect form values, searches, uploaded filenames or private URLs.
3. No password, API key or Measurement Protocol secret is needed for the tag.
   Do not paste a second Google tag into the editor or public landing page.

Creating the property and data stream requires Google account access. GitHub,
Vercel and Firebase project access do not grant that access. Existing reporting
history remains in the old property; the new property's history starts when
the new destination is activated.

## Release after the Measurement ID exists

1. Put the new public ID in `veteranResumesMeasurementId` in
   `api/_lib/resume-analytics-config.json`. Keep `measurementId` unchanged for
   the main website's legacy app.
2. Run `node test/resume-analytics.test.js` and the existing analytics privacy
   workflow, including its real Google SDK check. Commit and deploy the backend.
3. In the frontend repository, bump the collector query version in
   `resume-workspace-src/public/analytics-model.js` so existing CDN caches cannot
   retain the previous routing. Update `analytics-guide.html` to identify the new
   property and public ID. Run the required frontend checks and deploy.
4. Check the public page and `/app/` with Analytics consent granted. Confirm only
   the new ID is selected, Google request locations contain only the synthetic
   public screen URLs, and consent withdrawal stops collection. Check the legacy
   `veterancareerpath.com/resumereview/` origin still selects `G-CMFKLT321J`.
5. In the new property's Realtime report, confirm consented site/app activity.
   Do not claim Google reports are verified without account access.

Only exact trusted browser origins select destinations. A missing standalone ID
leaves that domain's collector unconfigured and never falls back to the main
website's property. Both the public landing page and the paid tools use the new
property, with distinct permitted screen paths and fixed event categories.

## AdSense account setup

The public landing page already publishes the verification meta tag for
`ca-pub-4999040528510137`. Its live `ads.txt` is:

```
google.com, pub-4999040528510137, DIRECT, f08c47fec0942fa0
```

The owner confirmed the domain has not yet been added to AdSense. Open
https://www.google.com/adsense/, choose Sites > New site, and add
`veteranresumes.com`. Select the existing meta tag or ads.txt verification method,
verify ownership, and request review. Google must approve the site and show
`Ready` before it can serve ads. Complete any Google account setup tasks, enable
Auto ads for this site, and publish the applicable consent messages in Privacy &
messaging. The site's optional advertising toggle does not replace Google's
required consent messages.

Ads remain limited to the public landing page. The paid app and shared Virtual
CV do not load AdSense. No Google account review, approval, real ad impression or
new Analytics property creation was performed during this preparation.
