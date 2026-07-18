-- Param: $1 website_url
SELECT id, name, phone, email, booking_url
FROM clinic
WHERE website_url = $1;
