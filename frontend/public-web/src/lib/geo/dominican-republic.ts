import type { GeoDivision } from "./catalog";

/**
 * Official territorial division of the Dominican Republic (ONE, 2021):
 * 31 provinces plus the Distrito Nacional and their 158 municipalities.
 * Codes follow ISO 3166-2:DO.
 */
export const DOMINICAN_REPUBLIC_DIVISIONS: readonly GeoDivision[] = [
  { code: "02", name: "Azua", cities: ["Azua de Compostela", "Estebanía", "Guayabal", "Las Charcas", "Las Yayas de Viajama", "Padre Las Casas", "Peralta", "Pueblo Viejo", "Sabana Yegua", "Tábara Arriba"] },
  { code: "03", name: "Bahoruco", cities: ["Galván", "Los Ríos", "Neiba", "Tamayo", "Villa Jaragua"] },
  { code: "04", name: "Barahona", cities: ["Barahona", "Cabral", "El Peñón", "Enriquillo", "Fundación", "Jaquimeyes", "La Ciénaga", "Las Salinas", "Paraíso", "Polo", "Vicente Noble"] },
  { code: "05", name: "Dajabón", cities: ["Dajabón", "El Pino", "Loma de Cabrera", "Partido", "Restauración"] },
  { code: "01", name: "Distrito Nacional", cities: ["Santo Domingo de Guzmán"] },
  { code: "06", name: "Duarte", cities: ["Arenoso", "Castillo", "Eugenio María de Hostos", "Las Guáranas", "Pimentel", "San Francisco de Macorís", "Villa Riva"] },
  { code: "08", name: "El Seibo", cities: ["El Seibo", "Miches"] },
  { code: "07", name: "Elías Piña", cities: ["Bánica", "Comendador", "El Llano", "Hondo Valle", "Juan Santiago", "Pedro Santana"] },
  { code: "09", name: "Espaillat", cities: ["Cayetano Germosén", "Gaspar Hernández", "Jamao al Norte", "Moca", "San Víctor"] },
  { code: "30", name: "Hato Mayor", cities: ["El Valle", "Hato Mayor del Rey", "Sabana de la Mar"] },
  { code: "19", name: "Hermanas Mirabal", cities: ["Salcedo", "Tenares", "Villa Tapia"] },
  { code: "10", name: "Independencia", cities: ["Cristóbal", "Duvergé", "Jimaní", "La Descubierta", "Mella", "Postrer Río"] },
  { code: "11", name: "La Altagracia", cities: ["Higüey", "San Rafael del Yuma"] },
  { code: "12", name: "La Romana", cities: ["Guaymate", "La Romana", "Villa Hermosa"] },
  { code: "13", name: "La Vega", cities: ["Constanza", "Jarabacoa", "Jima Abajo", "La Vega"] },
  { code: "14", name: "María Trinidad Sánchez", cities: ["Cabrera", "El Factor", "Nagua", "Río San Juan"] },
  { code: "28", name: "Monseñor Nouel", cities: ["Bonao", "Maimón", "Piedra Blanca"] },
  { code: "15", name: "Monte Cristi", cities: ["Castañuelas", "Guayubín", "Las Matas de Santa Cruz", "Monte Cristi", "Pepillo Salcedo", "Villa Vásquez"] },
  { code: "29", name: "Monte Plata", cities: ["Bayaguana", "Monte Plata", "Peralvillo", "Sabana Grande de Boyá", "Yamasá"] },
  { code: "16", name: "Pedernales", cities: ["Oviedo", "Pedernales"] },
  { code: "17", name: "Peravia", cities: ["Baní", "Matanzas", "Nizao"] },
  { code: "18", name: "Puerto Plata", cities: ["Altamira", "Guananico", "Imbert", "Los Hidalgos", "Luperón", "Puerto Plata", "Sosúa", "Villa Isabela", "Villa Montellano"] },
  { code: "20", name: "Samaná", cities: ["Las Terrenas", "Samaná", "Sánchez"] },
  { code: "21", name: "San Cristóbal", cities: ["Bajos de Haina", "Cambita Garabitos", "Los Cacaos", "Sabana Grande de Palenque", "San Cristóbal", "San Gregorio de Nigua", "Villa Altagracia", "Yaguate"] },
  { code: "31", name: "San José de Ocoa", cities: ["Rancho Arriba", "Sabana Larga", "San José de Ocoa"] },
  { code: "22", name: "San Juan", cities: ["Bohechío", "El Cercado", "Juan de Herrera", "Las Matas de Farfán", "San Juan de la Maguana", "Vallejuelo"] },
  { code: "23", name: "San Pedro de Macorís", cities: ["Consuelo", "Guayacanes", "Quisqueya", "Ramón Santana", "San José de Los Llanos", "San Pedro de Macorís"] },
  { code: "24", name: "Sánchez Ramírez", cities: ["Cevicos", "Cotuí", "Fantino", "La Mata"] },
  { code: "25", name: "Santiago", cities: ["Baitoa", "Jánico", "Licey al Medio", "Puñal", "Sabana Iglesia", "San José de las Matas", "Santiago de los Caballeros", "Tamboril", "Villa Bisonó", "Villa González"] },
  { code: "26", name: "Santiago Rodríguez", cities: ["Monción", "San Ignacio de Sabaneta", "Villa Los Almácigos"] },
  { code: "32", name: "Santo Domingo", cities: ["Boca Chica", "Los Alcarrizos", "Pedro Brand", "San Antonio de Guerra", "Santo Domingo Este", "Santo Domingo Norte", "Santo Domingo Oeste"] },
  { code: "27", name: "Valverde", cities: ["Esperanza", "Laguna Salada", "Mao"] },
];
