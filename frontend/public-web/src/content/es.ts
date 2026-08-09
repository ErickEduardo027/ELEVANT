export const es = {
  brand: {
    name: "ELEVANT",
    descriptor: "Inteligencia para operaciones en tierra",
  },
  navigation: [
    { label: "Experiencia", href: "#experiencia" },
    { label: "Flujo", href: "#flujo" },
    { label: "Capacidades", href: "#capacidades" },
    { label: "Piloto", href: "#piloto" },
  ],
  hero: {
    eyebrow: "ELEVANT · PILOTO PUJ",
    title: "Cada rotación deja una historia verificable.",
    lead:
      "ELEVANT conecta la planificación, la ejecución en rampa, la validación y los documentos autorizados en un solo recorrido.",
    primaryAction: "Solicitar demostración",
    secondaryAction: "Explorar el recorrido",
    telemetry: [
      { label: "Estación inicial", value: "PUJ" },
      { label: "Recorrido", value: "Una rotación" },
      { label: "Etapa", value: "Piloto demostrable" },
    ],
  },
  problem: {
    eyebrow: "Una misma operación. Demasiadas versiones.",
    title: "La operación avanza. La información debe avanzar con ella.",
    body:
      "Cuando el plan, la rampa y la revisión viven separados, reconstruir lo ocurrido consume tiempo y contexto. ELEVANT propone un hilo operativo común para que cada servicio pueda seguirse desde su asignación hasta su consulta autorizada.",
    note:
      "El objetivo no es añadir otra pantalla: es conservar la continuidad entre quienes coordinan, ejecutan y consultan.",
  },
  journey: {
    eyebrow: "Del vuelo a la evidencia",
    title: "Una rotación, cinco estados conectados.",
    lead:
      "La ruta organiza el trabajo y su contexto. Cada etapa prepara la siguiente sin borrar lo anterior.",
    stages: [
      {
        code: "01",
        name: "Planificar",
        owner: "OCC",
        description:
          "Seleccionar el vuelo, contrastar servicios y asignar personas, recursos y posición.",
      },
      {
        code: "02",
        name: "Ejecutar",
        owner: "Rampa",
        description:
          "Consultar la asignación y registrar servicios, tiempos, listas e incidencias en campo.",
      },
      {
        code: "03",
        name: "Evidenciar",
        owner: "Rampa",
        description:
          "Vincular observaciones y archivos a la atención que les dio origen.",
      },
      {
        code: "04",
        name: "Validar",
        owner: "OCC",
        description:
          "Revisar lo registrado, aprobarlo o devolver una discrepancia con su contexto.",
      },
      {
        code: "05",
        name: "Consultar",
        owner: "Aerolínea",
        description:
          "Acceder, según autorización, al recorrido operativo y a sus documentos disponibles.",
      },
    ],
  },
  actors: [
    {
      number: "01",
      label: "Centro de control",
      role: "OCC",
      title: "Planificar con el contexto de la rotación a la vista.",
      body:
        "El equipo de control reúne vuelo, contrato, servicios y asignaciones en una lectura operativa. Puede revisar la atención registrada sin desprenderla de su plan original.",
      points: [
        "Plan de atención por vuelo",
        "Asignación de agentes y recursos",
        "Revisión de incidencias y ejecución",
      ],
      image: "/assets/generated/occ-control.webp",
      alt: "Equipo de control operativo frente a paneles de planificación de vuelos",
      tone: "blue",
    },
    {
      number: "02",
      label: "Operación en campo",
      role: "Agente de rampa",
      title: "Registrar donde ocurre el servicio.",
      body:
        "El agente consulta su atención asignada y documenta servicios, tiempos, listas, incidencias y evidencias desde un dispositivo pensado para el entorno operativo.",
      points: [
        "Atenciones y listas asignadas",
        "Registro de servicios e incidencias",
        "Continuidad prevista ante conectividad limitada",
      ],
      image: "/assets/generated/agent-rain.webp",
      alt: "Agente de rampa usando una tableta junto a una aeronave bajo la lluvia",
      tone: "cyan",
    },
    {
      number: "03",
      label: "Consulta autorizada",
      role: "Aerolínea",
      title: "Llegar a la información sin alterar el registro operativo.",
      body:
        "El portal previsto para aerolíneas concentra consultas operativas, documentales y financieras de acuerdo con los permisos disponibles.",
      points: [
        "Consulta por vuelo y servicio",
        "Seguimiento documental previsto",
        "Solicitudes vinculadas a la operación",
      ],
      image: "/assets/generated/actor-airline.webp",
      alt: "Representante de aerolínea consultando información operativa desde un portátil",
      tone: "orange",
    },
  ],
  preview: {
    eyebrow: "Preview funcional · datos simulados",
    title: "La rotación se entiende de un vistazo y se comprueba en detalle.",
    lead:
      "Esta representación muestra la dirección del producto con información ficticia. No corresponde a una operación real ni a un despliegue productivo.",
    flight: "EV 204",
    route: "MIA → PUJ",
    stand: "A12",
    state: "En revisión",
    services: [
      { label: "Calzos colocados", time: "18:42", state: "Registrado" },
      { label: "Descarga de equipaje", time: "18:47", state: "En curso" },
      { label: "Evidencia de servicio", time: "18:51", state: "Adjunta" },
      { label: "Revisión OCC", time: "Pendiente", state: "Siguiente" },
    ],
  },
  pilot: {
    eyebrow: "Alcance inicial",
    airportCode: "PUJ",
    airport: "Aeropuerto Internacional de Punta Cana",
    title: "Empezar por una estación. Aprender de una operación concreta.",
    body:
      "El alcance inicial se plantea para un piloto de AVIAM en PUJ. La intención es validar el recorrido de trabajo con sus usuarios antes de proponer una evolución hacia otras estaciones.",
    evolutionTitle: "Visión de evolución",
    evolution:
      "Si el piloto confirma la utilidad operativa y técnica, la arquitectura podrá evaluarse para nuevos contextos, integraciones y estaciones. Esa expansión no forma parte del despliegue actual.",
  },
  demo: {
    eyebrow: "Próxima rotación",
    title: "Haga visible cada servicio de su próxima rotación.",
    lead:
      "Comparta el contexto de su operación y prepare una solicitud de demostración. El canal de envío aún no está habilitado, por lo que ningún dato saldrá de este dispositivo.",
  },
  login: {
    eyebrow: "Acceso de aerolíneas",
    title: "La operación, visible para quien debe verla.",
    body:
      "Inicia una sesión demostrativa o registra una aerolínea localmente para preparar el acceso al futuro portal.",
    action: "Volver a la landing",
    demoAction: "Usar credenciales de demostración",
  },
  footer: {
    statement: "Del vuelo a la evidencia.",
    legal:
      "ELEVANT se presenta como un piloto demostrable. Las escenas, interfaces y datos de esta página son ilustrativos.",
  },
} as const;

export type MarketingContent = typeof es;
