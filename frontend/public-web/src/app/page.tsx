import Image from "next/image";
import Link from "next/link";

import { MotionOrchestrator } from "@/components/marketing/MotionOrchestrator";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { HeroFlightScene } from "@/components/three/HeroFlightScene";
import { es } from "@/content/es";

export default function HomePage() {
  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">
        Saltar al contenido principal
      </a>
      <SiteHeader />
      <MotionOrchestrator />

      <main id="main-content">
        <section className="hero" id="experiencia" aria-labelledby="hero-title">
          <div className="hero__media">
            <HeroFlightScene />
          </div>

          <div className="hero__content shell">
            <p className="eyebrow eyebrow--bright">{es.hero.eyebrow}</p>
            <h1 id="hero-title">{es.hero.title}</h1>
            <p className="hero__lead">{es.hero.lead}</p>
            <div className="hero__actions">
              <Link className="button" href="/solicitar-acceso">
                {es.hero.primaryAction}
                <ArrowIcon />
              </Link>
              <Link className="text-link" href="#flujo">
                {es.hero.secondaryAction}
                <span aria-hidden="true">↓</span>
              </Link>
            </div>
          </div>

          <dl className="hero-telemetry shell">
            {es.hero.telemetry.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="hero__edge" aria-hidden="true">
            <span>Desplazar</span>
            <i />
          </div>
        </section>

        <section className="problem surface-light" aria-labelledby="problem-title">
          <div className="problem__layout shell section-pad">
            <div className="problem__headline" data-reveal="left">
              <p className="eyebrow eyebrow--ink">{es.problem.eyebrow}</p>
              <h2 id="problem-title">{es.problem.title}</h2>
            </div>
            <div className="problem__copy" data-reveal="right">
              <p>{es.problem.body}</p>
              <aside>
                <span aria-hidden="true">E/01</span>
                <p>{es.problem.note}</p>
              </aside>
            </div>
          </div>
          <div className="apron-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>

        <section className="journey section-pad" id="flujo" aria-labelledby="journey-title">
          <div className="shell">
            <header
              className="section-heading section-heading--split"
              data-reveal="up"
            >
              <div>
                <p className="eyebrow">{es.journey.eyebrow}</p>
                <h2 id="journey-title">{es.journey.title}</h2>
              </div>
              <p>{es.journey.lead}</p>
            </header>

            <ol className="journey-track" data-reveal="sequence">
              {es.journey.stages.map((stage, index) => (
                <li className="journey-stage" key={stage.name}>
                  <div className="journey-stage__rail" aria-hidden="true">
                    <span>{stage.code}</span>
                    <i />
                  </div>
                  <div className="journey-stage__content">
                    <p>{stage.owner}</p>
                    <h3>{stage.name}</h3>
                    <p>{stage.description}</p>
                  </div>
                  {index === 0 && (
                    <PlaneGlyph className="journey-stage__plane" />
                  )}
                </li>
              ))}
            </ol>

            <div className="journey__caption">
              <span>EV / PUJ / ROTACIÓN</span>
              <p>
                El orden describe un flujo propuesto; cada validación y permiso
                se definirá durante el piloto.
              </p>
            </div>
          </div>
        </section>

        <section className="actors" id="capacidades" aria-labelledby="actors-title">
          <div className="actors__intro shell section-pad" data-reveal="up">
            <p className="eyebrow">Tres perspectivas</p>
            <h2 id="actors-title">Un mismo recorrido, visto por quien lo mueve.</h2>
          </div>

          <div className="actor-chapters">
            {es.actors.map((actor) => (
              <article className="actor-chapter" data-tone={actor.tone} key={actor.role}>
                <div
                  className="actor-chapter__media"
                  data-motion-media
                  data-motion-scene={`actor-${actor.number}`}
                  data-motion-group={`actor-${actor.number}`}
                  data-parallax="24"
                  data-scan-direction={actor.number === "02" ? "reverse" : "forward"}
                >
                  <Image
                    src={actor.image}
                    alt={actor.alt}
                    fill
                    sizes="(max-width: 767px) 100vw, 58vw"
                  />
                  <div className="actor-chapter__image-label">
                    <span>{actor.number}</span>
                    <span>{actor.label}</span>
                  </div>
                </div>
                <div
                  className="actor-chapter__content"
                  data-reveal={actor.number === "02" ? "left" : "right"}
                  data-motion-group={`actor-${actor.number}`}
                >
                  <div className="actor-chapter__rule" aria-hidden="true" />
                  <p className="eyebrow">{actor.role}</p>
                  <h3>{actor.title}</h3>
                  <p className="actor-chapter__body">{actor.body}</p>
                  <ul>
                    {actor.points.map((point) => (
                      <li key={point}>
                        <span aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="preview-section section-pad" aria-labelledby="preview-title">
          <div className="shell preview-layout">
            <div className="preview-copy" data-reveal="left">
              <p className="eyebrow">{es.preview.eyebrow}</p>
              <h2 id="preview-title">{es.preview.title}</h2>
              <p>{es.preview.lead}</p>
              <div className="preview-copy__key">
                <span aria-hidden="true" />
                <p>
                  El color se acompaña siempre de texto para que cada estado sea
                  legible sin depender únicamente de la señal visual.
                </p>
              </div>
            </div>

            <div
              className="product-preview"
              data-reveal="preview"
              aria-label="Vista simulada de una rotación"
            >
              <div className="product-preview__bar">
                <div>
                  <span className="product-preview__mark" aria-hidden="true">E</span>
                  <span>ROTACIÓN / DETALLE</span>
                </div>
                <span>DATOS SIMULADOS</span>
              </div>

              <div className="product-preview__flight">
                <div>
                  <span>VUELO</span>
                  <strong>{es.preview.flight}</strong>
                </div>
                <div className="product-preview__route">
                  <PlaneGlyph />
                  <strong>{es.preview.route}</strong>
                  <span>POSICIÓN {es.preview.stand}</span>
                </div>
                <div className="status-chip">
                  <span aria-hidden="true" />
                  {es.preview.state}
                </div>
              </div>

              <div className="product-preview__timeline">
                <div className="timeline-heading">
                  <span>SECUENCIA DE SERVICIO</span>
                  <span>HORA LOCAL</span>
                </div>
                {es.preview.services.map((service, index) => (
                  <div className="timeline-row" key={service.label}>
                    <div className="timeline-row__index">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <i aria-hidden="true" />
                    </div>
                    <strong>{service.label}</strong>
                    <time>{service.time}</time>
                    <span>{service.state}</span>
                  </div>
                ))}
              </div>

              <div className="product-preview__footer">
                <span>Último registro mostrado: 18:51</span>
                <span>Preview no conectado</span>
              </div>
            </div>
          </div>
        </section>

        <section className="pilot section-pad" id="piloto" aria-labelledby="pilot-title">
          <div
            className="pilot__backdrop"
            data-motion-media
            data-motion-scene="pilot"
            data-motion-group="pilot"
            data-parallax="20"
            data-scan-direction="forward"
            aria-hidden="true"
          >
            <Image
              src="/assets/generated/turnaround-top.webp"
              alt=""
              fill
              sizes="100vw"
            />
          </div>
          <div className="pilot__scrim" aria-hidden="true" />
          <div className="pilot__layout shell">
            <div className="pilot__code" aria-hidden="true">
              {es.pilot.airportCode}
            </div>
            <div
              className="pilot__content"
              data-reveal="right"
              data-motion-group="pilot"
            >
              <p className="eyebrow eyebrow--bright">{es.pilot.eyebrow}</p>
              <p className="pilot__airport">{es.pilot.airport}</p>
              <h2 id="pilot-title">{es.pilot.title}</h2>
              <p>{es.pilot.body}</p>
              <div className="pilot__evolution">
                <span aria-hidden="true">↗</span>
                <div>
                  <h3>{es.pilot.evolutionTitle}</h3>
                  <p>{es.pilot.evolution}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="demo-section" id="demo" aria-labelledby="demo-title">
          <div
            className="demo-section__visual"
            data-motion-media
            data-motion-scene="closing"
            data-motion-group="closing"
            data-parallax="-16"
            data-scan-direction="reverse"
          >
            <Image
              src="/assets/generated/closing-sunset.webp"
              alt="Aeronave estacionada en plataforma al caer la tarde"
              fill
              loading="eager"
              sizes="(max-width: 899px) 100vw, 44vw"
            />
            <div className="demo-section__visual-copy">
              <span>PUJ / SIGUIENTE ROTACIÓN</span>
              <PlaneGlyph />
            </div>
          </div>
          <div className="demo-section__content section-pad">
            <div
              className="demo-section__inner"
              data-reveal="up"
              data-motion-group="closing"
            >
              <p className="eyebrow">{es.demo.eyebrow}</p>
              <h2 id="demo-title">{es.demo.title}</h2>
              <p className="demo-section__lead">{es.demo.lead}</p>
              <Link className="button" href="/solicitar-acceso">Solicitar acceso <ArrowIcon /></Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__main shell">
          <div>
            <p className="site-footer__brand">ELEVANT</p>
            <p className="site-footer__statement">{es.footer.statement}</p>
          </div>
          <nav aria-label="Navegación del pie de página">
            {es.navigation.map((item) => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <Link href="/login">Acceso clientes</Link>
          </nav>
        </div>
        <div className="site-footer__fineprint shell">
          <p>{es.footer.legal}</p>
          <p>
            Texturas terrestres: NASA Visible Earth. NASA no respalda ni
            patrocina ELEVANT.
          </p>
          <p>© {new Date().getFullYear()} ELEVANT · Piloto PUJ</p>
        </div>
      </footer>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function PlaneGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
    >
      <path d="M5 27.5 21 24 16 8l4-2 9 15 10-2.2c2.8-.6 4.5.4 5 2.2.5 1.8-.5 3.5-3 4.6L30 30l-6 13-3.6 1 1.4-12.5L8 33l-3-5.5Z" />
    </svg>
  );
}
