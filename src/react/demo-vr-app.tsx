import { useEffect, useMemo } from "react";

import { selectedComposition, selectedImageTake } from "../domain/project.js";
import { normalizeAudienceInSpace } from "../geometry/audience-in-space.js";
import { ImmersivePreviewPanel } from "./immersive-preview.js";
import { useWorkbenchSnapshot } from "./runtime-bridge.js";
import { useMediaUrl } from "./use-media-url.js";

const DEMO_TITLE = "Zenith · Demo inmersivo";
const DEMO_DESCRIPTION = "Explora el domemaster de Zenith directamente desde un celular o visor WebXR.";

export function DemoVrApp() {
  const snapshot = useWorkbenchSnapshot();
  const composition = selectedComposition(snapshot.document);
  const take = selectedImageTake(composition);
  const asset = take ? snapshot.document.project.assets[take.mediaAssetId] : null;
  const mediaUrl = useMediaUrl(asset);
  const spec = take?.spatialSpec ?? null;
  const audience = useMemo(
    () =>
      spec
        ? normalizeAudienceInSpace(snapshot.document.workspace.audience, spec.projectionMode, spec.surface)
        : snapshot.document.workspace.audience,
    [snapshot.document.workspace.audience, spec],
  );

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = DEMO_TITLE;
    if (description) description.content = DEMO_DESCRIPTION;
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="demo-vr-route">
      <header className="demo-vr-header">
        <a className="demo-vr-brand" href="/" aria-label="Abrir Zenith Spatial Workbench">
          <span className="brand-mark">Z</span>
          <span>
            <strong>ZENITH</strong>
            <small>IMMERSIVE DEMO</small>
          </span>
        </a>
        <a className="button ghost demo-vr-workbench-link" href="/">
          Abrir Workbench
        </a>
      </header>

      <section className="demo-vr-content" aria-labelledby="demo-vr-title">
        <figure className="demo-vr-artwork">
          {asset ? (
            <img src={mediaUrl ?? asset.storageRef} width={asset.width} height={asset.height} alt={asset.alt} />
          ) : (
            <div className="demo-vr-loading" aria-busy="true">
              Preparando domemaster…
            </div>
          )}
          <figcaption>
            <span>DEMO · EQUIDISTANT 180°</span>
            <strong>{take?.label ?? "Forest Domemaster"}</strong>
          </figcaption>
        </figure>

        <div className="demo-vr-launcher">
          <div className="demo-vr-copy">
            <span className="eyebrow">ACCESO DIRECTO</span>
            <h1 id="demo-vr-title">Explora el domemaster</h1>
            <p>
              En celular usa <strong>Phone Lookaround</strong>. En un visor compatible usa <strong>Enter VR</strong>.
            </p>
          </div>

          <ImmersivePreviewPanel
            mediaUrl={mediaUrl}
            mediaKind="image"
            spec={spec}
            audience={audience}
            label={take?.label ?? "Demo · Forest Domemaster 180°"}
            contentKey={`${snapshot.document.project.id}:${composition.id}:${take?.id ?? "demo"}`}
            presentation="demo-route"
          />

          <p className="demo-vr-permission-note">
            Toca una opción para comenzar. El navegador puede pedir permiso para usar movimiento o WebXR.
          </p>
        </div>
      </section>
    </main>
  );
}
