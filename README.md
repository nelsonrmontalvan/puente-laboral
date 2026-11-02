# Puente Laboral

Buscador de empleo en Costa Rica. Prueba de conexión: buscar → tocar la oferta → aplicar en el anuncio original. Sin base de datos todavía.

## Estructura
- `index.html` → la app (mobile-first, funciona en celular y PC)
- `api/empleos.js` → función serverless que consulta RapidAPI con la llave escondida
- `.env.example` → variables que hay que configurar

## 1. Preparar la llave (RapidAPI)
1. Regenerá tu llave en RapidAPI (la anterior quedó expuesta).
2. Suscribite (plan gratis) a **JSearch**. La misma llave sirve para todas las APIs de RapidAPI.
3. Si preferís LinkedIn, poné `PROVEEDOR=linkedin`.

## 2. Probar en la Mac
```zsh
npm i -g vercel
cd ~/Desktop/puente-laboral
cp .env.example .env.local      # y pegá la llave nueva dentro
vercel dev                       # abre http://localhost:3000
```

## 3. Publicar en Vercel
```zsh
vercel                           # primer deploy (crea el proyecto)
vercel env add RAPIDAPI_KEY      # pegá la llave, marcá Production
vercel env add PROVEEDOR         # jsearch
vercel --prod
```

## Diagnóstico
- Ver los datos crudos que manda la API: `/api/empleos?q=cajero&debug=1`
- Si abrís `index.html` con doble clic, la app entra en **modo demostración** con ofertas de ejemplo.
- Búsquedas iguales quedan en caché del CDN 30 minutos para no gastar la cuota.

## Bolsa de la iglesia (afiches)
- `api/afiches.js` → lista, publica y quita afiches (Vercel Blob, sin base de datos)
- `admin.html` → panel del admin en `/admin`, protegido con contraseña

Configuración en Vercel:
1. **Storage → Create → Blob**, acceso **Public**, conectado al proyecto (agrega `BLOB_READ_WRITE_TOKEN`).
2. Variable `ADMIN_PASSWORD` con una contraseña larga.
3. Redeploy.

Enlaces directos: `/#bolsa` abre la bolsa; `/#afiche-<id>` abre un afiche (es el link que se comparte por WhatsApp).
