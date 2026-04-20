---
created: 2026-04-20T16:42:48.085Z
title: Add optional folder finder to New Rule modal
area: ui
files: []
---

## Problem

In the disposition view for "Reviewed" emails, the "New Rule" modal does not include a folder finder/picker. Users creating new rules should be able to optionally specify a target folder, but currently there is no way to browse or search for folders within the modal.

## Solution

Add a folder finder/browser component to the "New Rule" modal in the Reviewed disposition view. The folder selection should be optional - users can still create rules without specifying a folder. Consider reusing any existing folder picker components from elsewhere in the app. The folder finder should allow users to browse available mail folders and select one as part of rule creation.
