export function SignedOut({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="panel p-6">
        <h1 className="text-[15px] font-semibold mb-2">Not signed in</h1>
        <p className="muted text-[13px] mb-3">
          {message ??
            "This project identifies coders by invite link, so that every code can be attributed to a person when reliability is computed."}
        </p>
        <p className="muted text-[13px]">
          Open the invite link the project lead sent you. It looks like{" "}
          <code className="text-[12px]">/join/&lt;token&gt;</code> and only needs to be opened once
          per browser.
        </p>
        <p className="faint text-[12px] mt-4">
          Setting the project up for the first time? Run{" "}
          <code>npm run seed:lead -- --name=&quot;Your Name&quot;</code> to mint the first link.
        </p>
      </div>
    </div>
  );
}
