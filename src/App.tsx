import React, { useEffect } from "react";
import { cleanupPDFWorkers } from "./utils/pdf-cleanup";

const App: React.FC = () => {
  useEffect(() => {
    // Clean up workers when window/tab is closed
    const handleBeforeUnload = () => {
      cleanupPDFWorkers();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return <div>Hello World</div>;
};

export default App;
