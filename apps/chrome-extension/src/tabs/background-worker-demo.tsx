import * as React from 'react';

import "../style.css";
import { Button } from '~components/ui/button';

export default function NewTab() {
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);

  // The worker only ever answers with a boolean: the session token itself
  // stays inside the service worker and is never shown to a page.
  const checkAuth = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();

    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, response => {
      setSignedIn(response?.signedIn === true);
    });
  };

  return (
    <div className="plasmo-bg-black plasmo-text-white plasmo-h-svh plasmo-flex plasmo-items-center plasmo-justify-center">
      <div className="plasmo-max-w-screen-lg">
        <h1 className="plasmo-text-3xl plasmo-mb-4">Clerk Background Service Worker demo</h1>
        <div className="App">
          <p className="plasmo-text-lg plasmo-py-2">This new tab simluates a content page where you might want to access user information, or make a request to your backend server on the user's behalf. The token stays in the service worker; pages only learn whether you are signed in.</p>
          <p className="plasmo-text-lg plasmo-py-2">Make sure that you are signed into the extension. You can have the popup closed.</p>
          <Button variant='default' className="plasmo-text-lg plasmo-mt-4"
            type='button'
            onClick={checkAuth}
          >
            Check Sign-in
          </Button>
          <p className="plasmo-mt-8 plasmo-mb-4 plasmo-text-lg">Signed in:</p>
          <div className="plasmo-border plasmo-border-white/50 w-full plasmo-break-all plasmo-h-52 plasmo-flex plasmo-items-center plasmo-justify-center plasmo-p-4">
            {signedIn !== null && <p>{signedIn ? 'Yes' : 'No'}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}



