import { Calculator } from "./components/Calculator";

export default function Home() {
  return (
    <div className="layout">
      <header>
        <h1>OpenShift AI vs hyperscaler frontier TCO</h1>
        <p>
          Pick AWS, Azure, or Google Cloud (region-specific), then a use case. Compare ROSA, ARO,
          or OSD with Bedrock, Azure OpenAI, Vertex AI, or self-hosted GPUs. Enter Red Hat quotes
          where list prices are not public.
        </p>
      </header>
      <Calculator />
    </div>
  );
}
