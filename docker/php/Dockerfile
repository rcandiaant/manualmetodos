FROM php:8.2-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu-dev libzip-dev unzip \
    && docker-php-ext-install pdo_mysql intl zip opcache \
    && pecl install apcu \
    && docker-php-ext-enable apcu \
    && a2enmod rewrite headers \
    && sed -i 's#/var/www/html#/app/public#g' /etc/apache2/sites-available/000-default.conf /etc/apache2/apache2.conf \
    && sed -i 's#<Directory /var/www/>#<Directory /app/public/>#' /etc/apache2/apache2.conf \
    && sed -i 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
    && rm -rf /var/lib/apt/lists/*

# Composer dentro de la misma imagen PHP 8.2: así ve las mismas extensiones que exige composer.json
# (ext-pdo_mysql, ext-mbstring, ext-sodium) y la imagen oficial composer:2, que no trae pdo_mysql, no hace falta.
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /app
