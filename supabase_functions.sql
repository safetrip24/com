-- Additional Supabase Functions and Views for Safetrip Service Logistics
-- Run these after the main setup.sql

-- 1. Create view for shipment details with user information
CREATE OR REPLACE VIEW shipment_details AS
SELECT 
    s.*,
    up.full_name as user_full_name,
    up.phone as user_phone,
    up.company as user_company
FROM shipments s
LEFT JOIN users_profiles up ON s.user_id = up.id;

-- 2. Create function to search shipments by tracking number (public access)
CREATE OR REPLACE FUNCTION public.search_shipment_by_tracking(p_tracking_number VARCHAR(50))
RETURNS TABLE (
    tracking_number VARCHAR(50),
    status VARCHAR(50),
    origin TEXT,
    destination TEXT,
    estimated_delivery DATE,
    last_updated TIMESTAMP WITH TIME ZONE,
    sender_name VARCHAR(255),
    receiver_name VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.tracking_number,
        s.status,
        s.origin,
        s.destination,
        s.estimated_delivery,
        s.last_updated,
        s.sender_name,
        s.receiver_name
    FROM shipments s
    WHERE s.tracking_number = p_tracking_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to get user's shipment statistics
CREATE OR REPLACE FUNCTION public.get_user_shipment_stats(p_user_id UUID)
RETURNS TABLE (
    total_shipments BIGINT,
    registered_count BIGINT,
    in_transit_count BIGINT,
    delivered_count BIGINT,
    total_value DECIMAL(12,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_shipments,
        COUNT(*) FILTER (WHERE status = 'Registered') as registered_count,
        COUNT(*) FILTER (WHERE status = 'In Transit') as in_transit_count,
        COUNT(*) FILTER (WHERE status = 'Delivered') as delivered_count,
        COALESCE(SUM(package_value), 0) as total_value
    FROM shipments
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create function to update shipment location
CREATE OR REPLACE FUNCTION public.update_shipment_location(
    p_tracking_number VARCHAR(50),
    p_location TEXT,
    p_status VARCHAR(50) DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_shipment_id UUID;
BEGIN
    -- Get shipment ID
    SELECT id INTO v_shipment_id
    FROM shipments
    WHERE tracking_number = p_tracking_number;
    
    IF v_shipment_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Update shipment
    UPDATE shipments 
    SET 
        current_location = p_location,
        status = COALESCE(p_status, status),
        last_updated = NOW(),
        updated_at = NOW()
    WHERE id = v_shipment_id;
    
    -- Insert tracking record
    INSERT INTO shipment_tracking (shipment_id, status, location, description)
    VALUES (v_shipment_id, COALESCE(p_status, status), p_location, 'Location updated');
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create function to mark shipment as delivered
CREATE OR REPLACE FUNCTION public.mark_shipment_delivered(p_tracking_number VARCHAR(50))
RETURNS BOOLEAN AS $$
DECLARE
    v_shipment_id UUID;
BEGIN
    -- Get shipment ID
    SELECT id INTO v_shipment_id
    FROM shipments
    WHERE tracking_number = p_tracking_number;
    
    IF v_shipment_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Update shipment status
    PERFORM public.update_shipment_status(
        v_shipment_id,
        'Delivered',
        (SELECT destination FROM shipments WHERE id = v_shipment_id),
        'Package delivered successfully'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create function to get recent shipments for dashboard
CREATE OR REPLACE FUNCTION public.get_recent_shipments(p_user_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    tracking_number VARCHAR(50),
    status VARCHAR(50),
    origin TEXT,
    destination TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    estimated_delivery DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.tracking_number,
        s.status,
        s.origin,
        s.destination,
        s.created_at,
        s.estimated_delivery
    FROM shipments s
    WHERE s.user_id = p_user_id
    ORDER BY s.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create function to get shipment analytics
CREATE OR REPLACE FUNCTION public.get_shipment_analytics(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    period_date DATE,
    shipments_count BIGINT,
    total_value DECIMAL(12,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE(s.created_at) as period_date,
        COUNT(*) as shipments_count,
        COALESCE(SUM(s.package_value), 0) as total_value
    FROM shipments s
    WHERE s.user_id = p_user_id
    AND s.created_at >= CURRENT_DATE - INTERVAL '1 day' * p_days
    GROUP BY DATE(s.created_at)
    ORDER BY period_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Create function to validate tracking number format
CREATE OR REPLACE FUNCTION public.validate_tracking_number(p_tracking_number VARCHAR(50))
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if tracking number starts with 'ST' and has valid format
    RETURN p_tracking_number ~ '^ST[0-9]{13}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 9. Create function to generate unique tracking number
CREATE OR REPLACE FUNCTION public.generate_tracking_number()
RETURNS VARCHAR(50) AS $$
DECLARE
    v_tracking_number VARCHAR(50);
    v_exists BOOLEAN;
BEGIN
    LOOP
        -- Generate tracking number: ST + timestamp + random 3 digits
        v_tracking_number := 'ST' || EXTRACT(EPOCH FROM NOW())::BIGINT || LPAD((RANDOM() * 999)::INTEGER::TEXT, 3, '0');
        
        -- Check if it already exists
        SELECT EXISTS(SELECT 1 FROM shipments WHERE tracking_number = v_tracking_number) INTO v_exists;
        
        -- If it doesn't exist, we can use it
        IF NOT v_exists THEN
            EXIT;
        END IF;
    END LOOP;
    
    RETURN v_tracking_number;
END;
$$ LANGUAGE plpgsql;

-- 10. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shipments_user_id ON shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_number ON shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_shipment_id ON shipment_tracking(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_timestamp ON shipment_tracking(tracking_timestamp);
CREATE INDEX IF NOT EXISTS idx_users_profiles_id ON users_profiles(id);

-- 11. Create function to clean up old tracking records (optional maintenance)
CREATE OR REPLACE FUNCTION public.cleanup_old_tracking_records(p_days_to_keep INTEGER DEFAULT 365)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM shipment_tracking 
    WHERE created_at < NOW() - INTERVAL '1 day' * p_days_to_keep;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Grant permissions for the new functions
GRANT EXECUTE ON FUNCTION public.search_shipment_by_tracking TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_shipment_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipment_location TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_shipment_delivered TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_shipments TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shipment_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tracking_number TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tracking_number TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_tracking_records TO authenticated;

-- 13. Create policy for public tracking search
CREATE POLICY "Public can search shipments by tracking number" ON shipments
    FOR SELECT USING (true);

-- 14. Create RLS policy for shipment_details view
-- Note: RLS policies cannot be applied to views. Ensure underlying tables
-- (e.g., `shipments`, `users_profiles`) have appropriate RLS policies instead.
