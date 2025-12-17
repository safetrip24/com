-- Supabase Backend Setup for Safetrip Service Logistics
-- Run these commands in your Supabase SQL Editor

-- 1. Create shipments table
CREATE TABLE IF NOT EXISTS shipments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tracking_number VARCHAR(50) UNIQUE NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_email VARCHAR(255) NOT NULL,
    sender_phone VARCHAR(50) NOT NULL,
    sender_address TEXT NOT NULL,
    receiver_name VARCHAR(255) NOT NULL,
    receiver_phone VARCHAR(50) NOT NULL,
    receiver_address TEXT NOT NULL,
    package_description TEXT NOT NULL,
    package_weight DECIMAL(10,2) NOT NULL,
    package_value DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Registered',
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    current_location TEXT,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    estimated_delivery DATE,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create shipment_tracking table for tracking history
CREATE TABLE IF NOT EXISTS shipment_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    location TEXT,
    description TEXT,
    tracking_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create users_profiles table for extended user information
CREATE TABLE IF NOT EXISTS users_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    company VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_profiles ENABLE ROW LEVEL SECURITY;

-- 5. Create policies for shipments table
-- Users can only see their own shipments
CREATE POLICY "Users can view own shipments" ON shipments
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own shipments
CREATE POLICY "Users can insert own shipments" ON shipments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own shipments
CREATE POLICY "Users can update own shipments" ON shipments
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own shipments
CREATE POLICY "Users can delete own shipments" ON shipments
    FOR DELETE USING (auth.uid() = user_id);

-- 6. Create policies for shipment_tracking table
-- Users can view tracking for their shipments
CREATE POLICY "Users can view tracking for own shipments" ON shipment_tracking
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM shipments 
            WHERE shipments.id = shipment_tracking.shipment_id 
            AND shipments.user_id = auth.uid()
        )
    );

-- Users can insert tracking for their shipments
CREATE POLICY "Users can insert tracking for own shipments" ON shipment_tracking
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM shipments 
            WHERE shipments.id = shipment_tracking.shipment_id 
            AND shipments.user_id = auth.uid()
        )
    );

-- 7. Create policies for users_profiles table
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON users_profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile" ON users_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON users_profiles
    FOR UPDATE USING (auth.uid() = id);

-- 8. Create function to automatically create user profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users_profiles (id, full_name)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Create trigger to automatically create profile on user signup
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 11. Create triggers for updated_at
CREATE TRIGGER handle_shipments_updated_at
    BEFORE UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_users_profiles_updated_at
    BEFORE UPDATE ON users_profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 12. Create function to update shipment status and tracking
CREATE OR REPLACE FUNCTION public.update_shipment_status(
    p_shipment_id UUID,
    p_status VARCHAR(50),
    p_location TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Update shipment status
    UPDATE shipments 
    SET 
        status = p_status,
        current_location = COALESCE(p_location, current_location),
        last_updated = NOW(),
        updated_at = NOW()
    WHERE id = p_shipment_id;
    
    -- Insert tracking record
    INSERT INTO shipment_tracking (shipment_id, status, location, description)
    VALUES (p_shipment_id, p_status, p_location, p_description);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Create function to get shipment tracking history
CREATE OR REPLACE FUNCTION public.get_shipment_tracking(p_tracking_number VARCHAR(50))
RETURNS TABLE (
    status VARCHAR(50),
    location TEXT,
    description TEXT,
    tracking_timestamp TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        st.status,
        st.location,
        st.description,
        st.tracking_timestamp
    FROM shipment_tracking st
    JOIN shipments s ON s.id = st.shipment_id
    WHERE s.tracking_number = p_tracking_number
    ORDER BY st.tracking_timestamp DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Automatically persist tracking when shipments are updated directly
CREATE OR REPLACE FUNCTION public.handle_shipment_update_tracking()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log when meaningful fields change
    IF (NEW.status IS DISTINCT FROM OLD.status)
        OR (NEW.current_location IS DISTINCT FROM OLD.current_location)
        OR (NEW.notes IS DISTINCT FROM OLD.notes)
    THEN
        INSERT INTO shipment_tracking (shipment_id, status, location, description, tracking_timestamp)
        VALUES (NEW.id, COALESCE(NEW.status, OLD.status), COALESCE(NEW.current_location, OLD.current_location),
                COALESCE(NULLIF(NEW.notes, ''), NULLIF(OLD.notes, ''), 'Status/location updated'), NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_shipments_update_tracking ON shipments;
CREATE TRIGGER trg_shipments_update_tracking
AFTER UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION public.handle_shipment_update_tracking();

-- 15. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- 16. Insert sample data (optional)
INSERT INTO shipments (
    tracking_number, sender_name, sender_email, sender_phone, sender_address,
    receiver_name, receiver_phone, receiver_address, package_description,
    package_weight, package_value, status, origin, destination, estimated_delivery
) VALUES 
(
    'ST1734567890123', 'John Smith', 'john@example.com', '+44 20 7946 0958',
    '123 London Street, London, UK', 'Jane Doe', '+44 20 7946 0959',
    '456 Manchester Avenue, Manchester, UK', 'Electronics Package',
    2.5, 150.00, 'In Transit', 'London, UK', 'Manchester, UK',
    CURRENT_DATE + INTERVAL '3 days'
),
(
    'ST1734567890124', 'Alice Johnson', 'alice@example.com', '+44 20 7946 0960',
    '789 Birmingham Road, Birmingham, UK', 'Bob Wilson', '+44 20 7946 0961',
    '321 Liverpool Lane, Liverpool, UK', 'Clothing Items',
    1.2, 75.50, 'Registered', 'Birmingham, UK', 'Liverpool, UK',
    CURRENT_DATE + INTERVAL '5 days'
);

-- 16. Insert sample tracking data
INSERT INTO shipment_tracking (shipment_id, status, location, description)
SELECT 
    s.id,
    'Registered',
    s.origin,
    'Shipment registered and ready for pickup'
FROM shipments s
WHERE s.tracking_number = 'ST1734567890123';

INSERT INTO shipment_tracking (shipment_id, status, location, description)
SELECT 
    s.id,
    'In Transit',
    'Distribution Center, London',
    'Package picked up and in transit'
FROM shipments s
WHERE s.tracking_number = 'ST1734567890123';

INSERT INTO shipment_tracking (shipment_id, status, location, description)
SELECT 
    s.id,
    'Registered',
    s.origin,
    'Shipment registered and ready for pickup'
FROM shipments s
WHERE s.tracking_number = 'ST1734567890124';
