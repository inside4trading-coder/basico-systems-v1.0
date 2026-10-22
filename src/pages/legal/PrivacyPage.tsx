import { Link } from "react-router-dom";
import LegalLayout, { LegalSection } from "./LegalLayout";

/** /privacidad: política de privacidad del servicio. */
export default function PrivacyPage() {
  return (
    <LegalLayout title="Política de privacidad">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Esta política explica qué datos trata B Systems, para qué y cómo los protege. Complementa los{" "}
        <Link to="/terminos" className="text-primary underline">
          Términos y condiciones de uso
        </Link>
        .
      </p>

      <LegalSection title="1. Quién decide sobre los datos">
        <p>
          Cada negocio (el Cliente) decide qué datos carga sobre sus clientes, proveedores y personal, y es responsable de
          ellos. B Systems los trata por cuenta del Cliente, solo para prestarle el Servicio.
        </p>
        <p>
          Los datos de las cuentas de acceso (nombre, correo y contraseña de cada usuario) los tratamos nosotros para dar
          acceso al Servicio y mantenerlo seguro.
        </p>
      </LegalSection>

      <LegalSection title="2. Qué datos tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cuenta:</strong> nombre, correo, contraseña (guardada cifrada; nadie puede leerla) y el rol en cada
            negocio.
          </li>
          <li>
            <strong>Negocio:</strong> nombre, razón social, RIF, dirección, teléfono, sedes, cajas y configuración.
          </li>
          <li>
            <strong>Operación:</strong> productos, existencias, ventas, pagos, cuentas, movimientos, cuentas por cobrar,
            obligaciones e importaciones de estados de cuenta.
          </li>
          <li>
            <strong>Clientes del negocio:</strong> nombre, documento de identidad y datos de contacto que el negocio decida
            registrar.
          </li>
          <li>
            <strong>Fichaje (si está activo):</strong> nombre del personal, horarios, marcas de entrada y salida, PIN
            (guardado cifrado) y, si el negocio lo pide, la ubicación del teléfono en el momento de fichar.
          </li>
          <li>
            <strong>Estudio de IA (si está activo):</strong> las fotos de producto que se suben para generar imágenes.
          </li>
          <li>
            <strong>Datos técnicos:</strong> registros de acceso y de errores necesarios para operar y proteger el Servicio.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Prestar el Servicio: vender, llevar inventario, administración, reportes y lo demás que el negocio use.</li>
          <li>Dar acceso y seguridad: iniciar sesión, invitar al equipo, restablecer contraseñas, prevenir abusos.</li>
          <li>Dar soporte y avisar de cambios importantes del Servicio.</li>
        </ul>
        <p>No vendemos datos ni los usamos para publicidad de terceros.</p>
      </LegalSection>

      <LegalSection title="4. Proveedores que nos ayudan">
        <p>Para funcionar usamos proveedores de infraestructura que tratan datos siguiendo nuestras instrucciones:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase: base de datos, cuentas de acceso y archivos (servidores en Estados Unidos).</li>
          <li>Vercel: alojamiento de la aplicación web.</li>
          <li>Un proveedor de correo para invitaciones y restablecimiento de contraseña.</li>
          <li>OpenRouter y el modelo de IA que use, solo para las fotos que se envían al Estudio de IA.</li>
        </ul>
        <p>Algunos de estos proveedores están fuera de Venezuela, por lo que los datos pueden almacenarse en otros países.</p>
      </LegalSection>

      <LegalSection title="5. Cómo los protegemos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Conexión cifrada entre tu dispositivo y el Servicio.</li>
          <li>Cada negocio está aislado: la base de datos impide que un negocio vea los datos de otro.</li>
          <li>Permisos por rol que el dueño de cada negocio controla.</li>
          <li>Contraseñas y PIN guardados cifrados.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Datos en tu dispositivo">
        <p>
          La aplicación guarda en tu navegador la sesión, el negocio activo y una copia de datos de trabajo (catálogo, tasa y
          ventas pendientes de sincronizar) para funcionar sin conexión. No usamos cookies de publicidad. Al cerrar sesión se
          borra la copia de datos de trabajo; las ventas pendientes se guardan hasta que se sincronizan.
        </p>
      </LegalSection>

      <LegalSection title="7. Cuánto tiempo los guardamos">
        <p>
          Mientras el negocio esté activo. Tras la baja los conservamos un tiempo razonable por si se pide una copia o la
          reactivación, y después los eliminamos, salvo lo que la ley obligue a guardar.
        </p>
      </LegalSection>

      <LegalSection title="8. Tus derechos">
        <p>
          Puedes pedir acceder a tus datos, corregirlos, exportarlos o eliminarlos. Los datos de un negocio los gestiona su
          dueño: el propio negocio puede exportarlos desde Configuración. Si eres cliente o empleado de un negocio que usa B
          Systems, dirígete primero a ese negocio.
        </p>
      </LegalSection>

      <LegalSection title="9. Menores de edad">
        <p>El Servicio es para negocios y no está dirigido a menores de edad.</p>
      </LegalSection>

      <LegalSection title="10. Cambios a esta política">
        <p>Podemos actualizar esta política. La fecha de arriba indica la versión vigente y avisaremos de los cambios importantes.</p>
      </LegalSection>

      <LegalSection title="11. Contacto">
        <p>Para consultas sobre privacidad, escríbenos por el canal de soporte que te indicamos al darte de alta.</p>
      </LegalSection>
    </LegalLayout>
  );
}
