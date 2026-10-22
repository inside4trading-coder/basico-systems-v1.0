import { Link } from "react-router-dom";
import LegalLayout, { LegalSection } from "./LegalLayout";

/** /terminos: términos y condiciones de uso del servicio. */
export default function TermsPage() {
  return (
    <LegalLayout title="Términos y condiciones de uso">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Estos términos regulan el uso de B Systems (el «Servicio»), un sistema en la nube para punto de venta, inventario,
        administración y reportes de negocios. Quien crea un negocio en el Servicio (el «Cliente») y las personas que el
        Cliente invita a su equipo (los «Usuarios») aceptan estos términos al usarlo.
      </p>

      <LegalSection title="1. El servicio">
        <p>
          B Systems ofrece acceso al Servicio por suscripción. Los módulos y cupos (sedes, cajas, usuarios y complementos
          como Fichaje, Estudio de IA o Cashea) dependen del plan acordado con cada Cliente y se muestran en
          Configuración → Plan.
        </p>
        <p>
          Podemos mejorar, cambiar o retirar funciones. Si un cambio quita algo importante de tu plan, te avisaremos con
          antelación razonable.
        </p>
      </LegalSection>

      <LegalSection title="2. Alta, cuentas y acceso">
        <p>
          El alta se hace con un enlace personal que te entregamos. Quien completa el alta queda como dueño del negocio y
          responde por las personas que invita y por los permisos que les da.
        </p>
        <p>
          Cada persona usa su propia cuenta. Guarda tu contraseña en secreto y avísanos si crees que alguien entró sin
          permiso. Eres responsable de lo que se haga con las cuentas de tu negocio.
        </p>
      </LegalSection>

      <LegalSection title="3. Prueba gratis, planes y pagos">
        <p>
          El Servicio puede incluir un periodo de prueba gratis. Al terminar, para seguir usándolo hace falta contratar un
          plan. El precio, la forma de pago y la moneda se acuerdan con cada Cliente.
        </p>
        <p>
          Si un pago no se recibe, podemos suspender el acceso al negocio. Mientras está suspendido, sus datos se conservan
          y el acceso vuelve al regularizar el pago.
        </p>
      </LegalSection>

      <LegalSection title="4. Uso aceptable">
        <p>No está permitido:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Usar el Servicio para actividades ilegales o para registrar operaciones falsas.</li>
          <li>Intentar acceder a datos de otros negocios o saltarse los permisos del sistema.</li>
          <li>Hacer pruebas de carga, copiar el software o revenderlo sin autorización.</li>
          <li>Subir contenido que infrinja derechos de terceros, incluidas las fotos que se usan en el Estudio de IA.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Tus datos">
        <p>
          Los datos que cargas (productos, ventas, clientes, cuentas, fichajes y demás) son tuyos. Los usamos solo para
          prestarte el Servicio, como se explica en la <Link to="/privacidad" className="text-primary underline">Política de privacidad</Link>.
        </p>
        <p>
          Puedes exportar tus datos en cualquier momento desde Configuración. Cada negocio está aislado de los demás: nadie
          de otro negocio puede ver tu información.
        </p>
      </LegalSection>

      <LegalSection title="6. Documentos, impuestos y tasa de cambio">
        <p>
          El Servicio emite <strong>notas de entrega</strong>. <strong>No emite facturas fiscales</strong> ni sustituye a una
          máquina fiscal o imprenta digital autorizada. Cumplir con las obligaciones tributarias (facturación, IVA, IGTF,
          libros y declaraciones) es responsabilidad del Cliente.
        </p>
        <p>
          Los reportes de impuestos son una ayuda para tu contador y no reemplazan su revisión. La tasa de cambio se toma de
          la fuente que elijas (el Banco Central de Venezuela o una tasa propia). Revisa que sea la correcta antes de cobrar.
        </p>
      </LegalSection>

      <LegalSection title="7. Disponibilidad y funcionamiento sin conexión">
        <p>
          Trabajamos para que el Servicio esté disponible siempre, pero puede haber interrupciones por mantenimiento, fallas
          de proveedores o de internet. El punto de venta puede seguir registrando ventas sin conexión y las sincroniza al
          volver la red; mientras tanto, conviene no cerrar sesión ni borrar los datos del navegador.
        </p>
      </LegalSection>

      <LegalSection title="8. Soporte">
        <p>Damos soporte por el canal que te indicamos al darte de alta, en el horario acordado con cada Cliente.</p>
      </LegalSection>

      <LegalSection title="9. Suspensión y baja">
        <p>
          Puedes dejar de usar el Servicio cuando quieras. Antes de darte de baja, exporta tus datos. Podemos suspender o
          cerrar un negocio si incumple estos términos o por falta de pago, avisando antes salvo que haya un riesgo para
          otros clientes o para el Servicio.
        </p>
        <p>
          Después de la baja conservamos los datos un tiempo razonable por si quieres volver o pedir una copia, y luego los
          eliminamos, salvo lo que la ley obligue a guardar.
        </p>
      </LegalSection>

      <LegalSection title="10. Responsabilidad">
        <p>
          El Servicio se ofrece tal como está. No respondemos por pérdidas indirectas, lucro cesante ni por decisiones
          tomadas con datos cargados de forma incorrecta. En cualquier caso, nuestra responsabilidad total se limita a lo que
          el Cliente pagó por el Servicio en los tres meses anteriores al hecho que la origine.
        </p>
      </LegalSection>

      <LegalSection title="11. Propiedad intelectual">
        <p>
          El software, la marca B Systems y los materiales del Servicio son de sus titulares. La suscripción da derecho a
          usarlos mientras esté vigente, no a copiarlos ni modificarlos.
        </p>
      </LegalSection>

      <LegalSection title="12. Cambios a estos términos">
        <p>
          Podemos actualizar estos términos. La fecha de arriba indica la versión vigente. Si el cambio es importante, te
          avisaremos dentro del Servicio. Seguir usándolo después del aviso implica aceptarlo.
        </p>
      </LegalSection>

      <LegalSection title="13. Contacto">
        <p>Para cualquier consulta sobre estos términos, escríbenos por el canal de soporte que te indicamos al darte de alta.</p>
      </LegalSection>
    </LegalLayout>
  );
}
